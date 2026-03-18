# Use pre-built strfry image, add Node.js for write-policy plugin
FROM dockurr/strfry:latest

RUN apk --no-cache add nodejs

COPY strfry.conf /etc/strfry.conf
COPY plugins/ /app/plugins/

RUN chmod +x /app/plugins/write-policy.js \
  && mkdir -p /data/strfry-db

VOLUME /data

EXPOSE 7777

ENTRYPOINT ["/app/strfry"]
CMD ["--config=/etc/strfry.conf", "relay"]
