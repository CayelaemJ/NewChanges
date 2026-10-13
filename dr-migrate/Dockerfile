FROM postgres:18-alpine
RUN apk add --no-cache bash coreutils
COPY dr-migrate/compare.sh /usr/local/bin/compare.sh
RUN chmod 700 /usr/local/bin/compare.sh
ENTRYPOINT ["/bin/bash", "/usr/local/bin/compare.sh"]
