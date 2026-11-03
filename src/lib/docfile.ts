// Document files live in the private bucket, or (for public plan files from מבא"ת) in the app's public folder: "public:/plans/...".
import { supabase } from './supabase';

const BUCKET = 'mt-documents';
export const isPublicFile = (path: string) => path.startsWith('public:');
// a file in public/ under the app's base: '/' on Vercel, './' in the GitHub build (app/)
export const publicUrl = (p: string) => new URL(import.meta.env.BASE_URL + p.replace(/^\//, ''), window.location.href).href;

export async function docUrl(path: string): Promise<string> {
  if (isPublicFile(path)) return publicUrl(path.slice('public:'.length));
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data) throw new Error(error?.message ?? 'לא ניתן לפתוח');
  return data.signedUrl;
}

export async function docBlob(path: string): Promise<Blob> {
  if (isPublicFile(path)) {
    const r = await fetch(publicUrl(path.slice('public:'.length)));
    if (!r.ok) throw new Error(`הקובץ לא נמצא (${r.status})`);
    return r.blob();
  }
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? 'לא ניתן להוריד');
  return data;
}
