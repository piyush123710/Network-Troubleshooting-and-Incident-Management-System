export const PYTHON_DIAGNOSTIC_SCRIPT = `"""
NetTrace CLI — Python + Windows CMD + MySQL Network Diagnostic & Incident Logger
Demonstrates the core automation engine using subprocess (ping, tracert, ipconfig, nslookup)
and mysql-connector-python for relational incident persistence.
"""
import subprocess
import re
import socket
import datetime
import mysql.connector

DB_CONFIG = {
    "host": "localhost",
    "user": "netops",
    "password": "CHANGE_ME",
    "database": "nettrace_ops"
}

def run_cmd(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    return result.stdout + result.stderr

def check_ping(target: str) -> dict:
    output = run_cmd(["ping", "-n", "4", target])
    loss_match = re.search(r"\\((\\d+)% loss\\)", output)
    avg_match = re.search(r"Average = (\\d+)ms", output)
    return {
        "tool": "ping",
        "loss_pct": int(loss_match.group(1)) if loss_match else 100,
        "avg_ms": int(avg_match.group(1)) if avg_match else None,
        "raw": output
    }

def check_nslookup(target: str) -> dict:
    output = run_cmd(["nslookup", target])
    failed = "can't find" in output.lower() or "timed out" in output.lower()
    return {"tool": "nslookup", "ok": not failed, "raw": output}

def check_tracert(target: str) -> dict:
    output = run_cmd(["tracert", "-d", "-h", "15", target])
    return {"tool": "tracert", "raw": output}

def check_ipconfig() -> dict:
    output = run_cmd(["ipconfig", "/all"])
    apipa = "169.254." in output
    return {"tool": "ipconfig", "apipa_detected": apipa, "raw": output}

def log_incident_mysql(title: str, priority: str, category: str, host: str, notes: str):
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()
    code = f"INC-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    cursor.execute(
        """
        INSERT INTO incidents (incident_code, title, description, priority, status, category, affected_host, assignee)
        VALUES (%s, %s, %s, %s, 'Open', %s, %s, 'NOC L1')
        """,
        (code, title, notes, priority, category, host)
    )
    conn.commit()
    cursor.close()
    conn.close()
    return code

if __name__ == "__main__":
    host = input("Enter target host or IP to diagnose: ").strip()
    dns_res = check_nslookup(host)
    ping_res = check_ping(host)
    print(ping_res["raw"])
    if not dns_res["ok"]:
        print("Diagnosis: DNS failure -> Logging P1 incident")
        log_incident_mysql(f"DNS resolution failure for {host}", "P1", "DNS", host, dns_res["raw"])
    elif ping_res["loss_pct"] == 100:
        trace_res = check_tracert(host)
        log_incident_mysql(f"100% Packet Loss to {host}", "P1", "Connectivity", host, trace_res["raw"])
    else:
        print(f"Healthy: avg={ping_res['avg_ms']}ms, loss={ping_res['loss_pct']}%")
`;

export const MYSQL_SCHEMA_SCRIPT = `-- MySQL 8.0 Relational Schema for Network Troubleshooting & Incident Management System
CREATE DATABASE IF NOT EXISTS nettrace_ops;
USE nettrace_ops;

CREATE TABLE diagnostic_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool ENUM('ping', 'tracert', 'ipconfig', 'nslookup', 'full_suite') NOT NULL,
  target VARCHAR(255) NOT NULL,
  status ENUM('healthy', 'degraded', 'failed') NOT NULL,
  latency_ms DECIMAL(8,2) NULL,
  packet_loss DECIMAL(5,2) NULL,
  summary TEXT NOT NULL,
  probable_cause TEXT NOT NULL,
  recommended_priority ENUM('P1', 'P2', 'P3', 'P4') NOT NULL DEFAULT 'P3',
  raw_output LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE incidents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  incident_code VARCHAR(32) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  priority ENUM('P1', 'P2', 'P3', 'P4') NOT NULL,
  status ENUM('Open', 'Investigating', 'Escalated', 'Resolved', 'Closed') NOT NULL DEFAULT 'Open',
  category ENUM('DNS', 'DHCP', 'Routing', 'Switching', 'Latency', 'Connectivity') NOT NULL,
  affected_host VARCHAR(255) NOT NULL,
  assignee VARCHAR(120) NOT NULL,
  sla_target_minutes INT NOT NULL DEFAULT 60,
  escalation_tier VARCHAR(80) NULL,
  escalated_to VARCHAR(120) NULL,
  escalation_ticket VARCHAR(64) NULL,
  escalation_notes TEXT NULL,
  root_cause TEXT NULL,
  diagnostic_run_id BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  FOREIGN KEY (diagnostic_run_id) REFERENCES diagnostic_runs(id) ON DELETE SET NULL,
  INDEX idx_priority_status (priority, status)
);

CREATE TABLE resolution_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT NOT NULL,
  author VARCHAR(120) NOT NULL,
  action_type ENUM('Diagnostic', 'Triage', 'Workaround', 'Escalation', 'Root Cause', 'Resolution') NOT NULL,
  command_used VARCHAR(255) NULL,
  notes TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);
`;
