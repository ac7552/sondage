# An heir tells Sondage that the Fellow has died. Nothing is opened until an admin
# confirms it (death certificate, obituary, a call with the family) and a waiting
# period passes. The Fellow is emailed straight away, in case it isn't true.
class InheritanceClaim < ApplicationRecord
  STATUSES = %w[reported confirmed refused complete].freeze

  belongs_to :fellow
  belongs_to :safety_contact
  belongs_to :heir_user, class_name: "User", optional: true
  belongs_to :decided_by, class_name: "User", optional: true
  has_many :recoveries, dependent: :nullify

  validates :status, inclusion: { in: STATUSES }
  validate(on: :create) { errors.add(:safety_contact, "is not an heir") unless safety_contact&.heir? && safety_contact.fellow_id == fellow_id }

  scope :active, -> { where(status: %w[reported confirmed]) }

  def self.wait_days = ENV.fetch("INHERITANCE_WAIT_DAYS", Rails.env.production? ? 14 : 0).to_f

  def reported? = status == "reported"
  def confirmed? = status == "confirmed"

  # Confirms the death, makes (or finds) the heir's account and starts the wait.
  def confirm!(admin, note: nil)
    transaction do
      user = User.find_by(email: safety_contact.email) ||
             User.create!(email: safety_contact.email, name: safety_contact.name, role: "heir", password: SecureRandom.base58(24))
      raise ArgumentError, "#{user.email} already has a #{user.role} account, so it can't be used as an heir's account" unless user.heir?
      update!(status: "confirmed", heir_user: user, decided_by: admin, decided_at: Time.current, release_after: self.class.wait_days.days.from_now, note:)
      fellow.update!(deceased_at: fellow.deceased_at || Time.current)
      fellow.user.api_tokens.destroy_all # the Fellow's own app can no longer act for them
      user
    end
  end

  def refuse!(admin, note: nil) = update!(status: "refused", decided_by: admin, decided_at: Time.current, note:)

  def current_recovery = recoveries.order(created_at: :desc).first
end
