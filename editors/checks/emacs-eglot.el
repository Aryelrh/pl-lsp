;;; Batch eglot check for editors/emacs/eglot.el. Run with:
;;;   emacs -Q --batch -l editors/checks/emacs-eglot.el
;;; Expects PLACITUM_FILE to point at a fixture with an E500 and a `let config`.
(require 'cl-lib)
(require 'eglot)
(require 'flymake)

(load-file (expand-file-name "../emacs/eglot.el" (file-name-directory load-file-name)))
(setq enable-local-variables :all)
(setq eglot-connect-timeout 20)

(defun check-wait (predicate seconds)
  (let ((deadline (+ (float-time) seconds)))
    (while (and (not (funcall predicate)) (< (float-time) deadline))
      (sit-for 0.1))))

(let* ((file (getenv "PLACITUM_FILE"))
       (source (with-temp-buffer (insert-file-contents file) (buffer-string))))
  (find-file file)
  (placitum-mode)
  (apply #'eglot--connect (eglot--guess-contact))
  (check-wait (lambda () (eglot-current-server)) 20)
  (unless (eglot-current-server)
    (princ "FAIL no eglot server\n")
    (kill-emacs 1))
  (sit-for 1)
  (let* ((server (eglot-current-server))
         (td (eglot--TextDocumentIdentifier))
         (events (cl-loop for buffer in (buffer-list)
                          when (string-match-p "EGLOT.*events" (buffer-name buffer))
                          concat (with-current-buffer buffer
                                   (buffer-substring-no-properties (point-min) (point-max)))))
         (hover (eglot--request server :textDocument/hover
                                (list :textDocument td :position (list :line 2 :character 9))))
         (contents (plist-get hover :contents))
         (hover-text (if (stringp contents) contents (plist-get contents :value)))
         (completion (eglot--request server :textDocument/completion
                                     (list :textDocument td :position (list :line 3 :character 9))))
         (has-config (cl-find "config" completion
                              :key (lambda (item) (plist-get item :label)) :test #'string=))
         (rename (eglot--request server :textDocument/rename
                                 (list :textDocument td :position (list :line 2 :character 9) :newName "z")))
         (edits (cl-loop for (_key value) on (plist-get rename :changes) by #'cddr
                         append (append value nil))))
    (princ (format "PASS server (%s)\n" (length source)))
    (princ (format "%s diagnostics received\n"
                   (if (string-match-p "E500_EVAL_UNBOUND_VAR" events) "PASS" "FAIL")))
    (princ (format "%s hover (%s)\n" (if (string-match-p "param" (or hover-text "")) "PASS" "FAIL") hover-text))
    (princ (format "%s completion\n" (if has-config "PASS" "FAIL")))
    (princ (format "%s rename (%d edits)\n" (if (= 2 (length edits)) "PASS" "FAIL") (length edits)))))
(kill-emacs 0)
