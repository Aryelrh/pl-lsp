;;; Placitum LSP with Eglot (Emacs 29+ ships eglot).
;;; Load this file, or copy the forms into your init.el.
;;; Requires `placitum-lsp` on PATH (npm link / npm install -g).

(define-derived-mode placitum-mode prog-mode "Placitum"
  "Major mode for Placitum files."
  (setq-local comment-start "# ")
  (setq-local comment-end ""))

(add-to-list 'auto-mode-alist '("\\.placitum\\'" . placitum-mode))

(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '(placitum-mode . ("placitum-lsp" "--stdio"))))
