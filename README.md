# À La Carte Restaurant Reservation System

A hotel guest reservation application for an à la carte restaurant, built with Next.js, TypeScript, Tailwind CSS, and MongoDB/Mongoose.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Set environment variables:

```bash
export MONGODB_URI="mongodb://localhost:27017/hotel-restaurant"
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD_HASH="<bcrypt-hash>"
```

3. Start the app:

```bash
npm run dev
```

4. Seed the database:

```bash
npx tsx scripts/seed.ts
```

## Admin login

Open `/admin/login` and sign in with the configured credentials.

## Notes

The app includes a mock fallback when MongoDB is not configured, but the project structure is ready for MongoDB-backed production deployment.
