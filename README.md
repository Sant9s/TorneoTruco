# Torneo Admin

Aplicacion simple para administrar un torneo con 80 equipos divididos en 16 grupos de 5.

## Flujo

1. Abra `equipos.html` y pegue los 80 nombres, uno por linea.
2. Entre a `grupos.html` y toque **Generar grupos**.
3. Marque los ganadores de cada partido en grupos.
4. Cuando todos los grupos esten completos, toque **Crear playoffs**.
5. Abra `playoffs.html` para seguir marcando ganadores hasta la final.

## Subida a Vercel

- Use `C:\Users\santo\PycharmProjects\TorneoAdmin` como carpeta del proyecto.
- No necesita instalacion de dependencias.
- `index.html` redirige a `equipos.html`.

## Persistencia compartida con Supabase

1. En Supabase, abra **SQL Editor** y ejecute:

```sql
create table if not exists tournament_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
```

2. En Supabase, vaya a **Project Settings > API** y copie:

- Project URL
- service_role key

3. En Vercel, vaya a **Project Settings > Environment Variables** y agregue:

- `SUPABASE_URL`: el Project URL de Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: la `service_role key` de Supabase

4. Haga redeploy en Vercel.

La app guarda y lee el estado compartido desde `/api/state`. `localStorage` queda como respaldo si Supabase o la API no estan disponibles.

