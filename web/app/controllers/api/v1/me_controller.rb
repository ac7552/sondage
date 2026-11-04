class Api::V1::MeController < Api::V1::BaseController
  def show
    user = current_user
    fellow = user.fellow
    interviews = fellow ? fellow.interviews.includes(:host, :capsule).where.not(status: "completed") : []
    render json: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      fellow: fellow && {
        id: fellow.id, name: fellow.display_name, stage: fellow.stage, signing_public_key: user.signing_public_key, age_recipient: fellow.age_recipient,
        safety_contacts: fellow.safety_contacts.map { |c| { name: c.name, email: c.email, role: c.role } },
        pending_recovery_id: fellow.recoveries.pending.first&.id,
        historian: fellow.historian&.name,
        journal_prompts_waiting: fellow.journal_prompts.waiting.count
      },
      interviews: interviews.map { |m|
        {
          id: m.id, title: m.title, media_type: m.media_type, scheduled_at: m.scheduled_at&.iso8601, status: m.status,
          historian: { name: m.host.name, signing_public_key: m.host.signing_public_key },
          capsule: m.capsule && { capsule_id: m.capsule.capsule_uuid, manifest_sha256: m.capsule.manifest_sha256 },
          ice_servers: Rails.configuration.x.ice_servers
        }
      }
    }
  end
end
