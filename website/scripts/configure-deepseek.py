"""Provision an API credential over SSH without echoing or saving it locally."""
import getpass
import json
import sys
import paramiko

client=paramiko.SSHClient()
client.load_system_host_keys()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('64.90.13.22',username='root',key_filename=sys.argv[1],look_for_keys=False)
secret=getpass.getpass('DeepSeek API key (hidden): ')
if not secret.startswith('sk-') or any(c.isspace() for c in secret):
    raise SystemExit('Invalid key format')
command="""import sys,os,json,urllib.request,urllib.error
key=sys.stdin.read().strip()
request=urllib.request.Request('https://api.deepseek.com/models',headers={'Authorization':'Bearer '+key})
try:
 with urllib.request.urlopen(request,timeout=30) as response: models=json.load(response)
except urllib.error.HTTPError as e:
 print(json.dumps({'status':e.code,'configured':False}));sys.exit(1)
os.makedirs('/etc/chainlab',mode=0o700,exist_ok=True)
fd=os.open('/etc/chainlab/deepseek.env',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:f.write('DEEPSEEK_API_KEY='+key+'\\n')
os.chmod('/etc/chainlab/deepseek.env',0o600)
print(json.dumps({'configured':True,'models':[m['id'] for m in models.get('data',[])]}))
"""
import shlex
stdin,stdout,stderr=client.exec_command('python3 -c '+shlex.quote(command))
stdin.write(secret);stdin.channel.shutdown_write();secret=None
print(stdout.read().decode());print('Exit:',stdout.channel.recv_exit_status())
client.close()
