import sys, re
src = open(sys.argv[1]).read()
start = src.index("/// The Lumora website.")
end = src.index("    open_in_browser(&format!(\"{SITE_URL}{page}\"))\n}\n") + len("    open_in_browser(&format!(\"{SITE_URL}{page}\"))\n}\n")
code = src[start:end].replace("#[tauri::command]\n", "")
code += '\nfn main() { let _ = open_site_page("x".to_owned()); let _ = open_in_browser; }\n'
open(sys.argv[2], 'w').write(code)
