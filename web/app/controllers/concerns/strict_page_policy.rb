# A strict Content Security Policy for the two pages that handle secrets in the browser:
# the safety-copy page (a piece of the Fellow's key sits in its #fragment) and the
# historian's interview room (signing key, raw recording).
#
# What it buys: no inline or third-party script can run there, and the page can only
# talk to Sondage itself, so an injected script has nowhere to send a piece. What it
# doesn't: it can't protect against Sondage's own server sending different scripts.
# For that, the script fingerprints are published (bin/rails sondage:script_hashes) so
# changes can be noticed by anyone watching.
module StrictPagePolicy
  extend ActiveSupport::Concern

  class_methods do
    # worklets: allow blob: scripts, which the raw recorder's AudioWorklet needs.
    def strict_page_policy(only:, worklets: false)
      content_security_policy(only:) do |p|
        p.default_src :none
        p.script_src(*[ :self, (:blob if worklets) ].compact)
        p.connect_src :self, "#{request.ssl? ? 'wss' : 'ws'}://#{request.host_with_port}"
        p.style_src :self, :unsafe_inline, "https://fonts.googleapis.com" # style="" attributes only; no script
        p.font_src "https://fonts.gstatic.com"
        p.img_src :self, :data, :blob
        p.media_src :self, :blob, "mediastream:"
        p.manifest_src :self
        p.base_uri :none
        p.form_action :self
        p.frame_ancestors :none
        p.object_src :none
      end

      after_action(only:) do
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
      end
    end
  end
end
