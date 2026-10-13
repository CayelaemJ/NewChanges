FROM postgres:18-alpine
RUN apk add --no-cache bash coreutils
COPY dr-migrate/migrate.sh /usr/local/bin/migrate.sh
RUN chmod 700 /usr/local/bin/migrate.sh
ENTRYPOINT ["/bin/bash", "/usr/local/bin/migrate.sh"]
