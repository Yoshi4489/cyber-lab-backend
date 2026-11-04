A team built a link preview service: paste a link, and their server fetches the page so you can see what it is before you click. The same server can reach an internal metadata service that hands out the service's credentials.

The team added a filter for internal addresses. Show them it isn't enough by recovering the preview service's secret key from the metadata service.

The lab has no outbound network access, so test only with addresses inside the lab.

**Scope:** only the lab page assigned to this session and the services it can reach.
