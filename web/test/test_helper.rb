ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

class ActiveSupport::TestCase
  # Builds a small, valid world: an admin, a historian, a Fellow and an interview.
  def build_world
    @admin = User.create!(name: "Admin", email: "a@test", password: "pw-123456", role: "admin")
    @historian = User.create!(name: "Historian", email: "h@test", password: "pw-123456", role: "historian", signing_public_key: key_b64)
    @fellow_user = User.create!(name: "Fellow", email: "f@test", password: "pw-123456", role: "fellow")
    @fellow = Fellow.create!(user: @fellow_user, admin: @admin, birth_year: 1940)
    @interview = Meeting.create!(fellow: @fellow, host: @historian, kind: "interview", title: "Interview")
  end

  def key_b64 = Base64.strict_encode64(SecureRandom.bytes(32))
end
