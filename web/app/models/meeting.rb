class Meeting < ApplicationRecord
  KINDS = { "ten_by_ten" => "10x10 session", "interview" => "Interview" }.freeze

  belongs_to :fellow
  belongs_to :host, class_name: "User"
  has_one :capsule, dependent: :restrict_with_error

  validates :title, presence: true
  validates :kind, inclusion: { in: KINDS.keys }
  validates :media_type, inclusion: { in: %w[audio video] }
  validates :status, inclusion: { in: %w[scheduled in_progress sealed completed] }
  validate :host_has_the_right_role

  scope :interviews, -> { where(kind: "interview") }

  def interview? = kind == "interview"
  def sealed? = status == "sealed"
  def participant?(user) = user && (user.id == host_id || user.id == fellow.user_id)

  private

  def host_has_the_right_role
    return unless host
    errors.add(:host, "must be a historian") if interview? && !host.historian?
    errors.add(:host, "must be an admin") if kind == "ten_by_ten" && !host.admin?
  end
end
