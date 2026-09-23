" Placitum LSP with vim-lsp (prabirshrestha/vim-lsp).
" Copy into ~/.vimrc after the vim-lsp plugin.
" Requires `placitum-lsp` on PATH (npm link / npm install -g).

augroup placitum_filetype
  autocmd!
  autocmd BufRead,BufNewFile *.placitum setfiletype placitum
augroup END

if executable('placitum-lsp')
  au User lsp_setup call lsp#register_server({
    \ 'name': 'placitum-lsp',
    \ 'cmd': {server_info -> ['placitum-lsp', '--stdio']},
    \ 'allowlist': ['placitum'],
    \ })
endif
