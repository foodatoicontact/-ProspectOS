import type {NextConfig} from 'next';
// Security headers on every page and API response (audit 2026-11-11, S1). The applied Content-Security-Policy only holds
// the directives that cannot break a script, a style or a request of the app: no framing by another site (clickjacking of
// the signed-in space), no <base> hijack, no plugin content. A full script/style policy needs nonces in the layout first.
// The public demo page /d/<token> sets its own stricter headers in its route (app/d/[token]/route.ts) and is left alone.
export const SECURITY_HEADERS=[
 {key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"},
 {key:'X-Frame-Options',value:'DENY'},
 {key:'X-Content-Type-Options',value:'nosniff'},
 {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
 // The app copies to the clipboard (allowed by default); it never uses the camera, the microphone, the location or payments.
 {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=(), usb=()'},
];
const nextConfig:NextConfig={
 poweredByHeader:false,
 async headers(){return [{source:'/((?!d/).*)',headers:SECURITY_HEADERS}]},
};
export default nextConfig;
