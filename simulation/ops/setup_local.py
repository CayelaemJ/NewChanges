"""Disposable Docker initialization; fails when invoked outside the local container."""
import os
import sys
import pymysql

if os.environ.get('SIM_ENV')!='local' or os.environ.get('SIM_DB_HOST')!='mysql' or os.environ.get('RUN_LOCAL_MYSQL_TESTS')!='yes':
    raise SystemExit('Refusing non-local database setup')

root_pw=os.environ['MYSQL_ROOT_PASSWORD']
users=[('sim_writer',os.environ['SIM_DB_PASSWORD']),
       ('sim_cdc',os.environ['SIM_CDC_PASSWORD']),
       ('sim_repl',os.environ['SIM_REPL_PASSWORD'])]
conn=pymysql.connect(host='mysql',user='root',password=root_pw,autocommit=True,connect_timeout=5)
try:
    with conn.cursor() as cur:
        for user,password in users:
            cur.execute(f"CREATE USER IF NOT EXISTS '{user}'@'%' IDENTIFIED BY %s",(password,))
        cur.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON fixer_sim.* TO 'sim_writer'@'%'")
        cur.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON fixer_sim_analytics.* TO 'sim_cdc'@'%'")
        cur.execute("GRANT SELECT ON fixer_sim.* TO 'sim_repl'@'%'")
        cur.execute("GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'sim_repl'@'%'")
        cur.execute("FLUSH PRIVILEGES")
finally:conn.close()
print('Disposable local test database roles initialized without printing credentials')
