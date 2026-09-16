import { supabase } from "./supabase-client.js";

export async function getSession() {
  var res = await supabase.auth.getSession();
  return res.data.session;
}

export function onAuthStateChange(cb) {
  supabase.auth.onAuthStateChange(function (_event, session) {
    cb(session);
  });
}

export function signInAnonymously() {
  return supabase.auth.signInAnonymously();
}

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

export function signOut() {
  return supabase.auth.signOut();
}
