"""Resumable upload of a verified artifact using an authorized local SSH key."""
import argparse
from pathlib import Path
import paramiko
from deploy import parallel_upload

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--host',required=True);p.add_argument('--identity',required=True,type=Path)
p.add_argument('--source',required=True,type=Path);p.add_argument('--target',required=True)
a=p.parse_args()
client=paramiko.SSHClient();client.load_system_host_keys()
known=Path.home()/'.ssh/known_hosts'
if known.exists():client.load_host_keys(str(known))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
    client.connect(a.host,username='root',key_filename=str(a.identity),allow_agent=False,look_for_keys=False,timeout=30)
    with client.open_sftp() as sftp:
        parallel_upload(client,sftp,a.source,a.target,a.host,'root',a.identity)
finally:client.close()
