Here is the env file that broke my deploy:

```bash
DATABASE_URL=postgres://app:hunter2@db.internal:5432/main
REDIS_URL=redis://cache.internal:6379
SESSION_SECRET=4f9c2b7e1a8d6c3f5b0e9a7d2c4f6b8a
```

I moved it out of the repo after that.
