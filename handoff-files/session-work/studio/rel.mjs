for (const repo of process.argv.slice(2)) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=3`, { headers: { 'User-Agent': 'x' } });
  const t = await r.text();
  console.log(repo, r.status);
  try {
    for (const rel of JSON.parse(t)) for (const a of rel.assets ?? []) console.log('  ', rel.tag_name, a.name, a.size, a.browser_download_url);
  } catch {
    console.log(t.slice(0, 300));
  }
}
