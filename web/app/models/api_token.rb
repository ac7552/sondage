# A sign-in for the desktop app. The token itself is shown once and never stored.
class ApiToken < ApplicationRecord
  belongs_to :user

  def self.digest(token) = Digest::SHA256.hexdigest(token.to_s)

  def self.issue!(user, client: nil)
    token = SecureRandom.base58(40)
    create!(user:, client:, token_digest: digest(token))
    token
  end

  def self.authenticate(token)
    return if token.blank?
    record = find_by(token_digest: digest(token))
    record&.touch(:last_used_at)
    record
  end
end
