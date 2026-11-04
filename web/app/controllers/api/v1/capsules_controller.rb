# Receives the public receipt of a sealed capsule. The capsule itself is never
# uploaded: it stays encrypted on storage the Fellow controls.
class Api::V1::CapsulesController < Api::V1::BaseController
  before_action :require_fellow!

  def create
    meeting = @fellow.interviews.find(params[:id])
    receipt = params.require(:receipt).to_unsafe_h.deep_stringify_keys
    return render(json: { error: "This interview is already sealed." }, status: :conflict) if meeting.capsule

    # The receipt must carry both registered keys: the Fellow's and the historian's.
    sigs = Array(receipt["signatures"])
    fellow_ok = sigs.any? { |s| s["role"] == "fellow" && s["publicKey"] == current_user.signing_public_key }
    historian_ok = sigs.any? { |s| s["role"] == "historian" && s["publicKey"] == meeting.host.signing_public_key }
    unless fellow_ok && historian_ok
      return render(json: { error: "The receipt's signatures don't match the registered keys." }, status: :unprocessable_entity)
    end

    capsule = nil
    ActiveRecord::Base.transaction do
      capsule = Capsule.from_receipt!(meeting, receipt)
      meeting.update!(status: "sealed")
      @fellow.update!(stage: "delivered")
    end
    AuditEvent.record!("capsule.sealed", actor: current_user, fellow: @fellow, subject: capsule, manifest_sha256: capsule.manifest_sha256, timestamp: capsule.timestamp_status)
    render json: { ok: true, fingerprint: capsule.fingerprint }, status: :created
  end
end
