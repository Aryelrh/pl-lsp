;;; Batch lsp-mode check for editors/emacs/lsp-mode.el. Run with an Emacs that
;;; has lsp-mode on load-path (see editors/checks/README.md):
;;;   <emacs-with-lsp-mode> -Q --batch -l editors/checks/emacs-lsp-mode.el
(load-file (expand-file-name "../emacs/lsp-mode.el" (file-name-directory load-file-name)))
(require 'lsp-mode)

(setq lsp-auto-guess-root t)
(setq lsp-keep-workspace-alive nil)

(let ((file (getenv "PLACITUM_FILE")))
  (find-file file)
  (placitum-mode)
  (lsp-mode 1)
  (let ((deadline (+ (float-time) 25)))
    (while (and (or (null (lsp-workspaces)) (= 0 (hash-table-count (lsp--server-capabilities))))
                (< (float-time) deadline))
      (sit-for 0.1)))
  (princ (format "%s connect (%d workspaces, %d capabilities)\n"
                 (if (lsp-workspaces) "PASS" "FAIL")
                 (length (lsp-workspaces))
                 (hash-table-count (lsp--server-capabilities))))
  (when (lsp-workspaces)
    (goto-char (point-min))
    (forward-line 2)
    (move-to-column 9)
    (let* ((hover (lsp-request "textDocument/hover" (lsp--text-document-position-params)))
           (contents (gethash "contents" hover))
           (text (if (hash-table-p contents) (gethash "value" contents) contents)))
      (princ (format "%s hover (%s)\n" (if (string-match-p "param" (or text "")) "PASS" "FAIL") text)))))
(kill-emacs 0)
