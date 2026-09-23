;;; Placitum LSP with lsp-mode.
;;; Load this file, or copy the forms into your init.el.
;;; Requires `placitum-lsp` on PATH (npm link / npm install -g).

(define-derived-mode placitum-mode prog-mode "Placitum"
  "Major mode for Placitum files."
  (setq-local comment-start "# ")
  (setq-local comment-end ""))

(add-to-list 'auto-mode-alist '("\\.placitum\\'" . placitum-mode))

(with-eval-after-load 'lsp-mode
  (lsp-register-client
   (make-lsp-client
    :new-connection (lsp-stdio-connection '("placitum-lsp" "--stdio"))
    :activation-fn (lsp-activate-on "placitum")
    :major-modes '(placitum-mode)
    :server-id 'placitum-lsp)))
