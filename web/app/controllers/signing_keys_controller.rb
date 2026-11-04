# The historian's browser creates its own signing key (it never leaves the
# browser) and registers the public half here, so the Fellow's app can check
# the historian's signature on a capsule.
class SigningKeysController < ApplicationController
  before_action { require_role(:historian) }

  def update
    key = params.require(:signing_public_key)
    previous = current_user.signing_public_key
    if current_user.update(signing_public_key: key, signing_key_registered_at: Time.current)
      AuditEvent.record!("historian.key_registered", actor: current_user, replaced: previous.present? && previous != key)
      render json: { ok: true, fingerprint: Digest::SHA256.hexdigest(Base64.decode64(key)).first(16).upcase.scan(/.{4}/).join(" ") }
    else
      render json: { ok: false, error: current_user.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end
end
