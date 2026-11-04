# Append-only: who did what, and when. Part of the chain of custody.
class AuditEvent < ApplicationRecord
  belongs_to :fellow, optional: true
  belongs_to :actor, class_name: "User", optional: true

  def readonly? = persisted?

  def self.record!(action, actor:, fellow: nil, subject: nil, **data)
    create!(action:, actor:, fellow:, subject_type: subject&.class&.name, subject_id: subject&.id, data_json: data.presence&.to_json)
  end
end
