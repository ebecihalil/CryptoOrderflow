# Server commands (Oracle Ampere, 4 OCPU / 24 GB)

Site: https://79-76-111-157.sslip.io · server 79.76.111.157 · app in /opt/crypto (systemd `crypto`, Caddy for HTTPS).
Secrets live only in `/etc/systemd/system/crypto.service.d/google.conf` on the server.

## Update the site
1. Merge https://github.com/ebecihalil/CryptoOrderflow/compare/main...claude/sweet-keller-2k18ks
2. PowerShell on your computer:
   `ssh -i $HOME\Downloads\ssh-key-2026-11-21.key ubuntu@79.76.111.157`
3. `sudo -i`
4. `cd /opt/crypto && git checkout -- package-lock.json && git pull && npm install && npm run build && systemctl restart crypto`
5. `journalctl -u crypto -n 8 --no-pager` (ends with "listening on port 10000")

## Checks
- Memory: `free -h; ps -o rss=,cmd= -C node | awk '{printf "site uses %.0f MB\n", $1/1024}'`
- Google sign-in on: `curl -s https://79-76-111-157.sslip.io/api/auth/providers` → `{"google":true}`
- Contact email errors: `journalctl -u crypto --since "1 hour ago" --no-pager | grep -i contact`
- Saved contact messages: `cd /opt/crypto && node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('.cache/contact.sqlite');console.table(d.prepare('select id,datetime(created_at/1000,\'unixepoch\') as time,name,email,topic,emailed from contact_messages order by id desc limit 10').all())"`
- HTTPS / Caddy: `journalctl -u caddy -n 20 --no-pager`

## History settings (in google.conf, then `systemctl daemon-reload; systemctl restart crypto`)
`RECORD_DAYS` (120), `BUBBLE_HOURS` (720), `PROFILE_DAYS` (120), `ALWAYS_RECORD` (BTC,ETH,SOL,XRP,DOGE).
Example: `echo "Environment=ALWAYS_RECORD=BTC,ETH,SOL,XRP,DOGE,BNB" >> /etc/systemd/system/crypto.service.d/google.conf`

## Firewall note
Oracle's Ubuntu image rejects traffic before custom rules: the 80/443 ACCEPT rules must come
before the REJECT rule (`iptables -L INPUT -n --line-numbers`), then `netfilter-persistent save`.
