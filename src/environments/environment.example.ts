// Copiar este archivo como environment.ts y environment.prod.ts
// completando con las credenciales reales del proyecto de Supabase.
// La anon key es publica por diseno (protegida por las policies de RLS),
// pero igual no se versiona junto al resto del codigo por buena practica.
export const environment = {
  production: false,
  supabaseUrl: 'https://qwgbvlfqqzwdgzxbdkdp.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3Z2J2bGZxcXp3ZGd6eGJka2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MDY3NDksImV4cCI6MjEwNDk4Mjc0OX0.5Bw6rpLStBfLuA9vu1MwejgsDFb2r96reQROcUxRcBo'
};
