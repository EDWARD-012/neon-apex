// The portal build: the game as game sites such as itch.io and CrazyGames
// run it, inside their own frame and from their own servers. There is no
// /api there, so accounts, cloud saves and play events are off, and the
// links that leave the game (the guides, the email address) are hidden.
// Progress still saves in the browser. Build it with
//
//   npx vite build --mode portal --outDir dist-portal
//
// and zip what is inside dist-portal, with index.html at the top.
export const PORTAL = import.meta.env.MODE === 'portal'
