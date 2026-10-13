FROM postgres:18-alpine
RUN apk add --no-cache bash coreutils
COPY dr-migrate/reconcile.sh /usr/local/bin/reconcile.sh
RUN chmod 700 /usr/local/bin/reconcile.sh
ENTRYPOINT ["/bin/bash", "/usr/local/bin/reconcile.sh"]
