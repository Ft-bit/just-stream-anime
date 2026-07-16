// api/comments.js — action-based comments API.
// GET  ?type=anime&id=21&episode=1        -> list a thread (episode optional)
// POST { action:'post',   ... }            -> create a comment or reply
// POST { action:'vote',   ... }            -> upvote/downvote/remove vote
// POST { action:'delete', ... }            -> soft-delete your own comment

const { getSession } = require('./_lib/session');
const { sbFetch } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }

  res.setHeader('Content-Type', 'application/json');

  try {
    if (req.method === 'GET') {
      return await listComments(req, res);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = body.action;
      if (action === 'post')   return await postComment(req, res, body);
      if (action === 'vote')   return await voteComment(req, res, body);
      if (action === 'delete') return await deleteComment(req, res, body);
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Unknown action' }));
    }
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  } catch (err) {
    console.error('comments api error:', err.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── LIST a thread (with nested replies + vote scores) ────────────────────────
async function listComments(req, res) {
  const { type, id, episode } = req.query;
  if (!type || !id) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'type and id are required' }));
  }

  let path = `/comments_with_votes?content_type=eq.${encodeURIComponent(type)}` +
             `&content_id=eq.${encodeURIComponent(id)}&is_deleted=eq.false&order=created_at.asc`;
  path += episode ? `&episode=eq.${encodeURIComponent(episode)}` : `&episode=is.null`;

  const rows = await sbFetch(path);

  // Nest replies under their parent comment
  const byId = {};
  rows.forEach(r => { r.replies = []; byId[r.id] = r; });
  const top = [];
  rows.forEach(r => {
    if (r.parent_id && byId[r.parent_id]) byId[r.parent_id].replies.push(r);
    else top.push(r);
  });

  res.statusCode = 200;
  res.end(JSON.stringify({ comments: top, total: rows.length }));
}

// ── POST a new comment or reply (requires login) ──────────────────────────────
async function postComment(req, res, body) {
  const session = getSession(req);
  if (!session) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Login required' }));
  }

  const { contentType, contentId, episode, parentId, text } = body;
  if (!contentType || !contentId || !text || !text.trim()) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Missing required fields' }));
  }
  if (text.length > 2000) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Comment is too long (max 2000 characters)' }));
  }

  const inserted = await sbFetch('/comments', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      content_type: contentType,
      content_id: String(contentId),
      episode: episode ? String(episode) : null,
      user_id: session.uid,
      parent_id: parentId || null,
      body: text.trim(),
    }),
  });

  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  res.statusCode = 200;
  res.end(JSON.stringify({
    comment: {
      ...row,
      username: session.username,
      avatar_url: session.avatarUrl,
      upvotes: 0, downvotes_raw: 0, score: 0, replies: [],
    },
  }));
}

// ── VOTE on a comment (1 = up, -1 = down, 0 = remove vote) ────────────────────
async function voteComment(req, res, body) {
  const session = getSession(req);
  if (!session) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Login required' }));
  }

  const { commentId, value } = body;
  if (!commentId || ![1, -1, 0].includes(value)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Invalid vote value' }));
  }

  if (value === 0) {
    await sbFetch(`/comment_votes?comment_id=eq.${commentId}&user_id=eq.${session.uid}`, {
      method: 'DELETE',
    });
  } else {
    await sbFetch('/comment_votes?on_conflict=comment_id,user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ comment_id: commentId, user_id: session.uid, value }),
    });
  }

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}

// ── DELETE (soft-delete) your own comment ──────────────────────────────────────
async function deleteComment(req, res, body) {
  const session = getSession(req);
  if (!session) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Login required' }));
  }

  const { commentId } = body;
  if (!commentId) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'commentId required' }));
  }

  // The user_id filter here means you can only ever delete your own comment,
  // even if someone tampers with the request to pass a different commentId.
  await sbFetch(`/comments?id=eq.${commentId}&user_id=eq.${session.uid}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_deleted: true }),
  });

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}
