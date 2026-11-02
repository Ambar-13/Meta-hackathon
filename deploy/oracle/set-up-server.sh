#!/usr/bin/env bash
# Prepares the Oracle server, and is safe to run again: deploy.sh runs it before every deploy, over SSH as the ubuntu user.
# It opens ports 80 and 443 in the server's own firewall (Oracle's Ubuntu image rejects new connections it has no rule for),
# installs Docker from Ubuntu's own packages, makes the folders, and adds a nightly database backup that keeps 7 days.
set -euo pipefail

for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    # The new rule goes above the image's REJECT rule, or the REJECT would answer first.
    line="$(sudo iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')"
    sudo iptables -I INPUT "${line:-1}" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
    echo "opened port $port"
  fi
done
# Keeps the rules across reboots; the image ships netfilter-persistent for this.
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null 2>&1; fi

if ! command -v docker >/dev/null || ! sudo docker compose version >/dev/null 2>&1; then
  sudo apt-get update -q
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io docker-compose-v2 docker-buildx
fi
sudo systemctl enable --now docker >/dev/null 2>&1

sudo mkdir -p /opt/meet-first/releases
sudo chown -R ubuntu:ubuntu /opt/meet-first
# The dumps hold every person's data, so their folder is closed to every account but its owner and root.
sudo install -d -m 700 -o ubuntu -g ubuntu /opt/meet-first/backups
sudo chmod 700 /opt/meet-first/backups

# At 03:00 server time: a compressed dump of the database, readable by root only (umask 077), then the dumps older than 7 days
# are removed.
echo "0 3 * * * root umask 077 && docker exec meet-first-postgres-1 pg_dump -U postgres -d meet_first | gzip > /opt/meet-first/backups/meet_first-\$(date +\%F).sql.gz && find /opt/meet-first/backups -name 'meet_first-*.sql.gz' -mtime +7 -delete" | sudo tee /etc/cron.d/meet-first-backup >/dev/null
echo "server ready: $(sudo docker --version), $(sudo docker compose version --short)"
