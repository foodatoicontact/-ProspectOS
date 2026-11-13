// Link-preview robots and crawlers: they are served the page like anyone (LinkedIn, Slack, WhatsApp… build their preview
// from it) but they are not a person opening the link — never counted as a view, never announced to the owner.
// A missing User-Agent is treated the same way: a browser always sends one.
const PREVIEW_BOTS=/linkedinbot|facebookexternalhit|facebot|meta-externalagent|slackbot|slack-imgproxy|twitterbot|whatsapp|telegrambot|discordbot|skypeuripreview|microsoftpreview|teamsbot|googlebot|google-inspectiontool|googleother|apis-google|bingbot|bingpreview|applebot|duckduckbot|yandex|baiduspider|pinterest|redditbot|embedly|quora link preview|vkshare|iframely|mastodon|bitlybot|snapchat|ia_archiver|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|perplexitybot|ccbot|headlesschrome|phantomjs|python-requests|python-urllib|curl\/|wget\/|go-http-client|okhttp|node-fetch|axios\/|undici|java\/|libwww|httpclient|\bbot\b|crawler|spider|preview|monitor|uptime|pingdom/i;
export function isPreviewBot(userAgent:string|null|undefined):boolean{
 const ua=(userAgent??'').trim();
 return !ua||PREVIEW_BOTS.test(ua);
}
// A browser fetching the page ahead of a click (prefetch / prerender) is not a view either.
export function isPrefetch(headers:{get(name:string):string|null}):boolean{
 const purpose=`${headers.get('purpose')??''} ${headers.get('sec-purpose')??''} ${headers.get('x-purpose')??''} ${headers.get('x-moz')??''}`.toLowerCase();
 return /prefetch|prerender|preview/.test(purpose);
}
