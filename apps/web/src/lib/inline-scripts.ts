/**
 * Scripts que van EN LÍNEA en la página (tienen que ejecutarse antes de pintar
 * o no dependen de ningún archivo). Están aquí, como texto fijo, porque la
 * política de seguridad (CSP, lib/server/csp.ts) solo deja ejecutar los scripts
 * en línea cuya huella SHA-256 conoce: la calcula de estos mismos textos.
 * Un script en línea que no esté en INLINE_SCRIPTS no se ejecuta.
 *
 * Nunca metas aquí datos que cambien por petición (la huella cambiaría).
 */
import { THEME_COOKIE, THEMES } from './theme.ts';
import { CONSENTS } from './consent.ts';
import { PANEL_COLORS } from './panel/colors.ts';

/**
 * Modo guardado y respuesta al aviso de cookies (ThemeScript.astro). Si hay
 * cookie, manda ella (es lo que ha pintado el servidor); sin cookie, lo de esta
 * visita (sessionStorage) o, con cookies aceptadas, localStorage (vista previa
 * sin servidor). Un valor viejo guardado sin consentimiento no se impone.
 * Con data-theme-fixed (web pública, siempre oscura) no se toca el modo.
 */
export const THEME_SCRIPT = `(()=>{
const themes=${JSON.stringify(THEMES)},consents=${JSON.stringify(CONSENTS)};
const root=document.documentElement;
const read=f=>{try{return f();}catch{return null;}};
const fromCookie=name=>read(()=>new RegExp('(?:^|;\\\\s*)'+name+'=([^;]*)').exec(document.cookie)?.[1]);
const consent=()=>fromCookie('consentimiento')??read(()=>localStorage.getItem('consentimiento'));
const preference=name=>fromCookie(name)??read(()=>sessionStorage.getItem(name))??(consent()==='aceptadas'?read(()=>localStorage.getItem(name)):null);
const apply=()=>{
if(!root.hasAttribute('data-theme-fixed')){const t=preference(${JSON.stringify(THEME_COOKIE)});if(t&&themes.includes(t))root.dataset.theme=t;}
const c=consent();if(c&&consents.includes(c))root.dataset.cookies=c;
};
apply();
document.addEventListener('astro:after-swap',apply);
})();`;

/**
 * Color elegido del panel y del portal: cookie (manda, es lo que ha pintado el
 * servidor); sin cookie, lo de esta visita o (con cookies aceptadas)
 * localStorage. Solo se aceptan colores de la lista.
 */
export const PANEL_COLOR_SCRIPT = `(()=>{
const ids=${JSON.stringify(PANEL_COLORS.map(c => c.id))};
const read=f=>{try{return f();}catch{return null;}};
const apply=()=>{
const c=read(()=>/(?:^|;\\s*)color_panel=([^;]*)/.exec(document.cookie)?.[1])??read(()=>sessionStorage.getItem('color_panel'))??(document.documentElement.dataset.cookies==='aceptadas'?read(()=>localStorage.getItem('color_panel')):null);
if(c&&ids.includes(c))document.documentElement.dataset.color=c;
};
apply();
document.addEventListener('astro:after-swap',apply);
})();`;

/**
 * Animaciones de entrada de la web pública (desenfoque → nítido). Sin
 * JavaScript o con «reducir movimiento», todo se ve y nada queda oculto.
 */
export const REVEAL_SCRIPT = `(()=>{
if(!('IntersectionObserver' in window)||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
const root=document.documentElement;
root.classList.add('anim');
document.addEventListener('DOMContentLoaded',()=>{
const io=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting){e.target.classList.add('is-in');io.unobserve(e.target);}}},{threshold:0.1});
document.querySelectorAll('[data-reveal]').forEach(el=>io.observe(el));
});
addEventListener('beforeprint',()=>root.classList.add('anim-done'));
})();`;

/** Diseño premium: marca que hay JavaScript (antes de pintar). */
export const PREMIUM_JS_SCRIPT = `document.documentElement.classList.add('pm-js');`;

export const INLINE_SCRIPTS = [THEME_SCRIPT, PANEL_COLOR_SCRIPT, REVEAL_SCRIPT, PREMIUM_JS_SCRIPT] as const;
