# API Reference

## Occurrences

### Get Nearby Occurrences

```
GET /api/occurrences/nearby?lat=37.77&lng=-122.41&radius=10000
```

### Get Occurrences by Bounding Box

```
GET /api/occurrences/bbox?minLat=...&minLng=...&maxLat=...&maxLng=...
```

### Get Occurrences as GeoJSON

```
GET /api/occurrences/geojson?minLat=...&minLng=...&maxLat=...&maxLng=...
```

For map clustering.

### Get Single Occurrence

```
GET /api/occurrences/:uri
```

## Identifications

### Get Identifications for Occurrence

```
GET /api/identifications/:occurrenceUri
```

## Taxonomy

### Search Taxa

```
GET /api/taxa/search?q=eschscholzia
```

### Validate Taxon Name

```
GET /api/taxa/validate?name=Eschscholzia%20californica
```

## Authentication

### Initiate Login

```
GET /oauth/login?handle=user.bsky.social
```

Redirects to PDS for OAuth.

### OAuth Callback

```
GET /oauth/callback
```

Handles OAuth redirect.

### Logout

```
POST /oauth/logout
```

### Get Current User

```
GET /oauth/me
```

Returns authenticated user info or null.
