"""Read-only CHAINLAB MRIO API. Put a reverse proxy in front of loopback port 8787."""

import argparse
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
import sys
import os
from urllib.parse import parse_qs, urlsplit

from mrio import DEFAULT_DB, QueryError, catalog, export_csv, open_readonly, prepare_query, table


class Handler(BaseHTTPRequestHandler):
    server_version = "ChainlabAPI/1"

    def json_response(self, status, value):
        content = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.response_started = True
        self.wfile.write(content)

    def do_GET(self):
        self.response_started = False
        try:
            parsed = urlsplit(self.path)
            if parsed.path in ('/api/briefing', '/api/briefing/editions'):
                from briefing import read_briefing, editions
                if len(parsed.query) > 100:
                    raise QueryError('早报参数过长')
                values = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=2)
                if set(values) - {'date'} or any(len(v) != 1 for v in values.values()) or (parsed.path.endswith('/editions') and values):
                    raise QueryError('早报参数无效')
                try:
                    result = {'editions': editions()} if parsed.path.endswith('/editions') else read_briefing(edition=values.get('date', [None])[0])
                except ValueError:
                    raise QueryError('请选择有效的期刊日期') from None
                except FileNotFoundError:
                    self.json_response(404, {'error': '该期早报尚未存档'})
                    return
                self.json_response(200, result)
                return
            if parsed.path.startswith('/api/library/'):
                from library_http import handle_library
                handle_library(self)
                return
            if len(parsed.query) > 4096:
                raise QueryError("查询参数过长")
            params = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=20)
            if any(len(value) != 1 for value in params.values()):
                raise QueryError("查询参数不可重复")
            params = {name: values[0] for name, values in params.items()}
            if parsed.path in {"/api/knowledge", "/api/knowledge/entities"}:
                if self.server.topology is None:
                    self.json_response(503, {"error": "图谱计算环境尚未就绪"})
                else:
                    from knowledge import query, entity_list
                    action = entity_list if parsed.path.endswith("/entities") else query
                    self.json_response(200, action(self.server.topology, params))
                return
            if parsed.path in {"/api/topology", "/api/topology/neighbors"}:
                if self.server.topology is None:
                    self.json_response(503, {"error": "网络计算环境尚未就绪，请稍后重试"})
                else:
                    action = self.server.topology.neighbors if parsed.path.endswith("/neighbors") else self.server.topology.query
                    self.json_response(200, action(params))
                return
            if parsed.path not in {"/api/health", "/api/catalog", "/api/table", "/api/export"}:
                self.json_response(404, {"error": "未找到此接口"})
                return
            with closing(open_readonly(self.server.database)) as connection:
                if parsed.path in ("/api/health", "/api/catalog"):
                    if params:
                        raise QueryError("此接口不接受查询参数")
                    data = catalog(connection)
                    if parsed.path == "/api/health":
                        data = {"status": "ok", "database": "read-only", "year_count": len(data["years"]),
                                "first_year": data["years"][0]["year"], "last_year": data["years"][-1]["year"],
                                "complete_year_coverage": data["complete_year_coverage"],
                                "topology": self.server.topology is not None}
                    self.json_response(200, data)
                    return
                query = prepare_query(connection, params)
                if parsed.path == "/api/table":
                    self.json_response(200, table(connection, query))
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                filename = f"chainlab-mrio-{query['year']}-{query['view']}.csv"
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("X-MRIO-Source-SHA256", query["metadata"]["sha256"])
                self.send_header("X-MRIO-Rows", str(len(query["rows"])))
                self.send_header("X-MRIO-Columns", str(len(query["columns"])))
                self.send_header("Connection", "close")
                self.end_headers()
                self.response_started = True
                self.close_connection = True

                for block in export_csv(connection, query):
                    self.wfile.write(block)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (QueryError, ValueError) as error:
            self.json_response(400, {"error": str(error)})
        except (sqlite3.Error, OSError, RuntimeError):
            self.log_error("Database request failed")
            if not self.response_started:
                self.json_response(503, {"error": "数据库暂时不可用，请稍后重试"})
            else:
                self.close_connection = True

    def do_POST(self):
        self.response_started = False
        if urlsplit(self.path).path.startswith('/api/library/'):
            from library_http import handle_library
            handle_library(self)
        else:
            self.json_response(405, {'error': '此接口不支持写入'})

    do_PATCH = do_POST
    do_DELETE = do_POST

    def do_HEAD(self):
        self.response_started = False
        if urlsplit(self.path).path.startswith('/api/library/'):
            from library_http import handle_library
            handle_library(self)
        else:
            self.send_response(405)
            self.send_header('Content-Length','0')
            self.end_headers()


def create_server(database: Path, host="127.0.0.1", port=8787, library_root=None):
    server = ThreadingHTTPServer((host, port), Handler)
    server.database = Path(database).resolve()
    folder=Path(library_root or os.environ.get('CHAINLAB_LIBRARY_ROOT',server.database.parent/'library'))
    if (folder/'library.sqlite3').exists():
        from library import LibraryStore
        server.library=LibraryStore(folder)
    else:
        server.library=None
    try:
        if sys.version_info < (3, 10):
            raise ImportError("Network kernel requires Python 3.10 or newer")
        from topology import TopologyEngine
        server.topology = TopologyEngine(server.database)
    except ImportError:
        server.topology = None
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", "--database", dest="database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    with closing(open_readonly(args.database)) as connection:
        info = catalog(connection)
    server = create_server(args.database, args.host, args.port)
    print(f"CHAINLAB read-only API: http://{args.host}:{args.port}/api/health; "
          f"{len(info['years'])} years", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
