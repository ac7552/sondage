class User < ApplicationRecord
  ROLES = %w[fellow admin historian].freeze

  devise :database_authenticatable, :recoverable, :rememberable, :validatable, :lockable
  has_many :api_tokens, dependent: :destroy
  has_one :fellow, dependent: :destroy
  has_many :hosted_meetings, class_name: "Meeting", foreign_key: :host_id, dependent: :restrict_with_error

  validates :name, presence: true
  validates :role, inclusion: { in: ROLES }
  validates :signing_public_key, format: { with: /\A[A-Za-z0-9+\/]{43}=\z/, message: "must be a base64 Ed25519 public key" }, allow_nil: true

  ROLES.each { |r| define_method(:"#{r}?") { role == r } }

  def first_name = name.split.first

  # Fellows the person may see: admins see everyone, historians see the people they interview.
  def visible_fellows
    case role
    when "admin" then Fellow.all
    when "historian" then Fellow.where(id: hosted_meetings.select(:fellow_id))
    else Fellow.where(user_id: id)
    end
  end

  def can_see?(fellow) = visible_fellows.exists?(fellow.id)
end
