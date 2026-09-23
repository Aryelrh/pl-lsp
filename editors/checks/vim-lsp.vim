" Batch vim-lsp check for editors/vim/vim-lsp.vim. Run with:
"   vim -es -u NONE --cmd "set loadplugins" --cmd "set runtimepath^=$VIMLSP" \
"       -c "source editors/checks/vim-lsp.vim"
" Expects PLACITUM_FILE to point at a fixture with an E500.
set nomore
let s:dir = expand('<sfile>:p:h')
execute 'source' fnameescape(s:dir . '/../vim/vim-lsp.vim')
call lsp#enable()
execute 'edit' fnameescape($PLACITUM_FILE)
sleep 8
let s:out = []
call add(s:out, (lsp#get_server_status('placitum-lsp') ==# 'running' ? 'PASS' : 'FAIL') . ' server status')
let s:uri = lsp#utils#get_buffer_uri(bufnr('%'))
let s:diags = lsp#internal#diagnostics#state#_get_all_diagnostics_grouped_by_uri_and_server()
call add(s:out, (len(get(s:diags, s:uri, {})) > 0 ? 'PASS' : 'FAIL') . ' diagnostics received')
new
call setline(1, s:out)
%print
qa!
