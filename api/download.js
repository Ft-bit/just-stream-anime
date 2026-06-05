// api/download.js
// AnimePahe resolution is now done client-side (browser) to avoid server IP blocks.
// This endpoint is kept for future use / fallback title lookup.
const ANILIST = 'https://graphql.anilist.co';

async function getTitle(aniId) {
  try {
    const r = await fetch(ANILIST, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query:     'query($id:Int){Media(id:$id,type:ANIME){title{english romaji}}}',
        variables: { id: parseInt(aniId) },
      }),
    });
    const d = await r.json();
    return d.data?.Media?.title?.english || d.data?.Media?.title?.romaji || null;
  } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { aniId, ep = '1' } = req.query;
  if (!aniId) return res.status(400).json({ error: 'aniId required' });

  const title = await getTitle(aniId);
  // Return title only — browser handles AnimePahe chain to avoid server IP blocks
  return res.status(200).json({ title: title || null, episode: parseInt(ep) || 1 });
};
