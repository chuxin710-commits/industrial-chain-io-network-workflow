"""Provision the one shared library account; the password is accepted only on stdin."""

import argparse
import getpass
import json
from pathlib import Path
import sys


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username',required=True)
    parser.add_argument('--root',type=Path)
    parser.add_argument('--host')
    parser.add_argument('--identity',type=Path)
    args=parser.parse_args()
    password=getpass.getpass('Library password (input hidden): ')
    if args.host:
        import paramiko
        client=paramiko.SSHClient();client.load_system_host_keys();client.load_host_keys(str(Path.home()/'.ssh/known_hosts'))
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        client.connect(args.host,username='root',key_filename=str(args.identity),allow_agent=False,look_for_keys=False,timeout=25)
        command="cd /opt/chainlab/current/server && /opt/chainlab/current/runtime/bin/python -c 'import sys,json;from library import LibraryStore;p=json.load(sys.stdin);s=LibraryStore(\"/var/lib/chainlab/library\");s.provision_shared_account(p[\"username\"],p[\"password\"]);print(\"Shared library account configured\")'"
        stdin,stdout,stderr=client.exec_command(command)
        stdin.write(json.dumps({'username':args.username,'password':password}));stdin.channel.shutdown_write()
        output=stdout.read().decode();error=stderr.read().decode();result=stdout.channel.recv_exit_status();client.close()
        if result:raise SystemExit(error)
        print(output.strip())
    else:
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
        from library import LibraryStore
        root=args.root or Path(__file__).resolve().parents[1]/'var/library'
        LibraryStore(root).provision_shared_account(args.username,password)
        print('Shared library account configured')


if __name__=='__main__':main()
