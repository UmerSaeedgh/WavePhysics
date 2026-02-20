# Azure PostgreSQL Setup Instructions

## Connection Details
- **Server**: wavephysics.postgres.database.azure.com
- **Username**: wavephysics
- **Password**: Database123
- **Database**: postgres (default)
- **Port**: 5432

## Step 1: Configure Azure PostgreSQL Firewall

Before connecting, you need to allow your IP address in Azure PostgreSQL firewall rules.

### Option A: Using Azure Portal
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to your PostgreSQL server: `wavephysics`
3. Go to **Settings** → **Connection security** (or **Networking**)
4. Click **Add client IP** to add your current IP address
5. Or manually add a rule:
   - Rule name: `AllowMyIP` (or any name)
   - Start IP address: Your current IP
   - End IP address: Your current IP
6. Click **Save**

### Option B: Using Azure CLI
```bash
# Get your current IP
curl ifconfig.me

# Add firewall rule (replace YOUR_IP with your actual IP)
az postgres server firewall-rule create \
  --resource-group fastapi-wave \
  --server wavephysics \
  --name AllowMyIP \
  --start-ip-address YOUR_IP \
  --end-ip-address YOUR_IP
```

### Option C: Allow All Azure Services (Less Secure)
- Enable "Allow access to Azure services" in Connection security settings
- ⚠️ **Warning**: This is less secure and should only be used for testing

## Step 2: Initialize the Database Schema

### Option A: Using Python Script (Recommended)
```bash
cd WavePhysics
python init_azure_postgres.py
```

This script will:
- Connect to Azure PostgreSQL
- Create all required tables
- Create indexes for performance
- Verify the setup

### Option B: Using psql Command Line
If you have `psql` installed:
```bash
psql "host=wavephysics.postgres.database.azure.com port=5432 dbname=postgres user=wavephysics password=Database123 sslmode=require" -f schema_postgres.sql
```

### Option C: Using Azure Cloud Shell
1. Go to Azure Portal → Cloud Shell
2. Upload `schema_postgres.sql`
3. Run:
```bash
psql "host=wavephysics.postgres.database.azure.com port=5432 dbname=postgres user=wavephysics password=Database123 sslmode=require" -f schema_postgres.sql
```

## Step 3: Verify Tables Created

Connect to the database and verify:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

You should see these tables:
- businesses
- clients
- sites
- contacts
- contact_links
- equipment_types
- test_types
- equipment_record
- notes
- attachments
- client_equipments
- users
- auth_tokens
- equipment_completions

## Troubleshooting

### Connection Timeout
- **Cause**: Your IP is not in the firewall rules
- **Solution**: Add your IP to Azure PostgreSQL firewall rules (see Step 1)

### SSL Connection Error
- **Cause**: SSL configuration issue
- **Solution**: Ensure `sslmode=require` is set in connection string

### Authentication Failed
- **Cause**: Wrong username or password
- **Solution**: Verify credentials in Azure Portal

### Database Not Found
- **Cause**: Database name might be different
- **Solution**: Check available databases or create a new one

## Using the PostgreSQL Connection in Your Application

Update your environment variables or connection string:
```python
# Environment variables
DB_HOST=wavephysics.postgres.database.azure.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=wavephysics
DB_PASSWORD=Database123

# Or full connection string
DATABASE_URL=postgresql://wavephysics:Database123@wavephysics.postgres.database.azure.com:5432/postgres?sslmode=require
```

Then use `sql_postgres.py`:
```python
from sql_postgres import connect_db, init_schema

conn = connect_db()
init_schema(conn)
```

## Security Notes

⚠️ **Important**: 
- Never commit passwords to version control
- Use environment variables or Azure Key Vault for credentials
- Regularly rotate passwords
- Use specific IP firewall rules instead of allowing all Azure services in production

