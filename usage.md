# 🎬 Anime API

A REST API that provides anime data including homepage sections, anime details, characters, episodes, streaming servers, schedules, filters, and more.

---

# 🌐 Base URL

```
http://localhost:3030/api/v1
```

All endpoints return:

```json
{
  "status": true,
  "data": {}
}
```

---

# 🏠 Home

## GET `/home`

```bash
curl http://localhost:3030/api/v1/home
```

### Response Structure

```json
{
  "status": true,
  "data": {
    "spotlight": [],
    "trending": [],
    "topAiring": [],
    "mostPopular": [],
    "mostFavorite": [],
    "latestCompleted": [],
    "latestEpisode": [],
    "newAdded": [],
    "topUpcoming": [],
    "topTen": {
      "today": [],
      "week": [],
      "month": []
    },
    "genres": []
  }
}
```

---

# 🌟 Spotlight

## GET `/spotlight`

```bash
curl http://localhost:3030/api/v1/spotlight
```

### Returns

```json
{
  "status": true,
  "data": [
    {
      "title": "string",
      "alternativeTitle": "string",
      "id": "string",
      "poster": "https://example.com",
      "episodes": {
        "sub": 1,
        "dub": 1,
        "eps": 1
      },
      "rank": 1,
      "type": "string",
      "quality": "string",
      "duration": "string",
      "aired": "string",
      "synopsis": "string"
    }
  ]
}
```

---

# 🔟 Top Ten

## GET `/topten`

```bash
curl http://localhost:3030/api/v1/topten
```

```json
{
  "status": true,
  "data": {
    "today": [],
    "week": [],
    "month": []
  }
}
```

---

# 🎬 Anime Details

## GET `/anime/{id}`

```bash
curl http://localhost:3030/api/v1/anime/steins-gate-3
```

### Returns

```json
{
  "status": true,
  "data": {
    "title": "string",
    "alternativeTitle": "string",
    "id": "string",
    "poster": "https://example.com",
    "episodes": {
      "sub": 1,
      "dub": 1,
      "eps": 1
    },
    "rating": "string",
    "type": "string",
    "is18Plus": true,
    "synopsis": "string",
    "synonyms": "string",
    "aired": {
      "from": "string",
      "to": "string"
    },
    "premiered": "string",
    "duration": "string",
    "status": "string",
    "MAL_score": "string",
    "genres": [],
    "studios": [],
    "producers": [],
    "related": [],
    "mostPopular": [],
    "recommended": []
  }
}
```

---

# 🎲 Random Anime

## GET `/anime/random`

Same structure as `/anime/{id}`.

---

# 🔍 Search

## GET `/search?keyword=one`

```json
{
  "status": true,
  "data": {
    "pageInfo": {
      "currentPage": 1,
      "hasNextPage": false,
      "totalPages": 1
    },
    "response": [
      {
        "title": "string",
        "alternativeTitle": "string",
        "id": "string",
        "poster": "https://example.com",
        "episodes": {},
        "type": "string",
        "duration": "string"
      }
    ]
  }
}
```

---

# 💡 Suggestion

## GET `/suggestion?keyword=one`

```json
{
  "status": true,
  "data": [
    {
      "title": "string",
      "alternativeTitle": "string",
      "id": "string",
      "poster": "https://example.com",
      "aired": "string",
      "type": "string",
      "duration": "string"
    }
  ]
}
```

---

# 👥 Characters

## GET `/characters/{animeId}`

```json
{
  "status": true,
  "data": {
    "pageInfo": {},
    "response": [
      {
        "name": "string",
        "id": "string",
        "imageUrl": "https://example.com",
        "role": "string",
        "voiceActors": []
      }
    ]
  }
}
```

---

# 🧍 Character Details

## GET `/character/{id}`

```json
{
  "status": true,
  "data": {
    "name": "string",
    "type": "string",
    "japanese": "string",
    "imageUrl": "https://example.com",
    "bio": "string",
    "animeApearances": []
  }
}
```

---

# 🎙 Actor

## GET `/actor/{id}`

```json
{
  "status": true,
  "data": {
    "name": "string",
    "type": "string",
    "japanese": "string",
    "imageUrl": "https://example.com",
    "bio": "string",
    "voiceActingRoles": []
  }
}
```

---

# 🎭 Genre

## GET `/genre/{genre}`

Returns paginated anime list.

---

# 🔤 A-Z List

## GET `/az-list/{letter}`

Returns paginated alphabetical list.

---

# 🏢 Producer

## GET `/producer/{id}`

Returns paginated anime by producer.

---

# ⚙ Filter

## GET `/filter`

Supports filters:
- type
- status
- rated
- score
- season
- language
- sort
- genres

Returns paginated results.

---

# 📺 Episodes

## GET `/episodes/{animeId}`

```json
{
  "status": true,
  "data": [
    {
      "title": "string",
      "alternativeTitle": "string",
      "id": "string",
      "isFiller": true,
      "episodeNumber": 1
    }
  ]
}
```

---

# 🖥 Servers

## GET `/servers/{episodeId}`

```json
{
  "status": true,
  "data": {
    "episode": 1,
    "sub": [],
    "dub": []
  }
}
```

---

# ▶ Stream

## GET `/stream?id={episodeId}`

```json
{
  "status": true,
  "data": [
    {
      "id": "string",
      "type": "sub",
      "link": {
        "file": "https://example.com",
        "type": "string"
      },
      "tracks": [],
      "intro": {
        "start": 1,
        "end": 1
      },
      "outro": {
        "start": 1,
        "end": 1
      },
      "server": "hd-1",
      "referer": "https://megacloud.tv"
    }
  ]
}
```

---

# 📅 Schedule

## GET `/schedule?date=`

```json
{
  "status": true,
  "data": {
    "meta": {
      "date": "ISO Date",
      "currentDate": "ISO Date",
      "lastDate": "ISO Date"
    },
    "response": []
  }
}
```

## GET `/schedule/next/{id}`

```json
{
  "status": true,
  "data": {
    "time": "string"
  }
}
```

---

# 🧾 Meta

## GET `/meta`

```json
{
  "status": true,
  "data": {
    "genres": [],
    "azList": [],
    "exploreRoutes": [],
    "filterOptions": {}
  }
}
```

---

# 🔥 Top Airing

## GET `/top-airing`

Returns paginated top airing anime list.

---

# 🚀 Run Locally

```bash
npm install
npm run dev
```

Server runs on:

```
http://localhost:3030
```

---

# 📄 License

Educational purposes only.
