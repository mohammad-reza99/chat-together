# Together

Together yek chat room-e realtime ba `React`, `Vite` va `Supabase` ast. Login ba Google anjam mishavad, message-ha live sync mishavand, presence online neshan dade mishavad, va indicator-e `typing` ham dar room dar dastres ast.

## Featureha

- Google OAuth ba Supabase Auth
- realtime message stream
- online presence
- typing indicator
- quick emoji bar
- loading, empty, error, va config states
- UI responsive va production-ready

## Run Local

1. dependency ha ra nasb kon:

```bash
npm install
```

2. az rooye `.env.example` yek file be esm `.env` besaz:

```bash
cp .env.example .env
```

3. meghdar haye zir ra ba info project-e Supabase por kon:

```env
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

4. SQL schema ra dar Supabase ejra kon:

file: `supabase/messages.sql`

5. app ra اجرا kon:

```bash
npm run dev
```

## Scriptha

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

## Database

Table `messages` baraye in موارد set shode:

- `id`
- `user_id`
- `email`
- `avatar_url`
- `body`
- `created_at`

RLS policy ha faal shode-and ta:

- user haye authenticated message ha ra ببینند
- faqat haman user betavanad payam khodesh ra insert konad

## Notes

- max tool-e message dar UI barabar `500` character ast.
- file `src/lib/supabase.js` marjae asli config client ast.
- agar env set nabashad, app yek setup state ro neshan midahad bejaye inke crash konad.
