# Railway PostgreSQL Connection Info

## Connection Details

**Host**: `caboose.proxy.rlwy.net`  
**Port**: `47161`  
**Database**: `railway`  
**Username**: `postgres`  
**Password**: `cQIgzaGtUWRlOqRqbGwApqgdTiPYbwBq`

## DATABASE_URL

```
DATABASE_URL=postgresql://postgres:cQIgzaGtUWRlOqRqbGwApqgdTiPYbwBq@caboose.proxy.rlwy.net:47161/railway
```

## DBeaver Connection Settings

1. **New Connection** → **PostgreSQL**
2. **Main Tab**:
   - **Host**: `caboose.proxy.rlwy.net`
   - **Port**: `47161`
   - **Database**: `railway`
   - **Username**: `postgres`
   - **Password**: `cQIgzaGtUWRlOqRqbGwApqgdTiPYbwBq`
3. **Test Connection** → Should work!

## Quick Test Commands

### psql Command Line
```bash
PGPASSWORD=cQIgzaGtUWRlOqRqbGwApqgdTiPYbwBq psql -h caboose.proxy.rlwy.net -U postgres -p 47161 -d railway
```

### Check Tables Exist
```sql
\dt  -- List all tables
SELECT * FROM research_runs;  -- Check research_runs table
```

### Migrate Report (via psql)
See `DATABASE_MIGRATION.md` for SQL examples.

## Run Migration Script

```bash
# Export DATABASE_URL
export DATABASE_URL="postgresql://postgres:cQIgzaGtUWRlOqRqbGwApqgdTiPYbwBq@caboose.proxy.rlwy.net:47161/railway"

# Or add to .env.local
echo "DATABASE_URL=postgresql://postgres:cQIgzaGtUWRlOqRqbGwApqgdTiPYbwBq@caboose.proxy.rlwy.net:47161/railway" >> .env.local

# Run migration
npx tsx --env-file=.env.local scripts/migrate-report-to-db.ts
```
