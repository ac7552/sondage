class Api::V1::MeController < Api::V1::BaseController
  def show
    user = current_user
    fellow = user.fellow
    interviews = fellow ? fellow.interviews.includes(:host, :capsule).where.not(status: "completed") : []
    render json: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      fellow: fellow && {
        id: fellow.id, name: fellow.display_name, stage: fellow.stage, signing_public_key: user.signing_public_key, age_recipient: fellow.age_recipient,
        safety_contacts: fellow.safety_contacts.map { |c| { id: c.id, name: c.name, email: c.email, role: c.role, heir: c.heir } },
        pending_recovery_id: fellow.recoveries.pending.first&.id,
        historian: fellow.historian&.name,
        journal_prompts_waiting: fellow.journal_prompts.waiting.count,
        next_journal_prompt: fellow.journal_prompts.waiting.includes(:author).first&.then { |p| { text: p.text, from: p.author.name } },
        journal_entries_count: fellow.journal_entries.count,
        # The newest page, for the notebook on the home screen. Only ever sent to the Fellow.
        last_journal_entry: fellow.journal_entries.newest_first.first&.then { |e| { written_on: e.written_on.iso8601, body: e.body.to_s.first(600), voice: e.voice.attached? } }
      },
      interviews: interviews.map { |m|
        {
          id: m.id, title: m.title, part: m.part, parts: fellow.interviews.count, media_type: m.media_type, scheduled_at: m.scheduled_at&.iso8601, status: m.status,
          historian: { name: m.host.name, signing_public_key: m.host.signing_public_key },
          capsule: m.capsule && { capsule_id: m.capsule.capsule_uuid, manifest_sha256: m.capsule.manifest_sha256 },
          ice_servers: CallRelay.ice_servers_for(user),
          relay_only: CallRelay.relay_only?
        }
      }
    }
  end
end
