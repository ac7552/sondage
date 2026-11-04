require "test_helper"

# The four safety copies and getting a key back on a new computer.
class SafetyFlowTest < ActionDispatch::IntegrationTest
  setup do
    build_world
    post "/api/v1/session", params: { email: "f@test", password: "pw-123456" }, as: :json
    @auth = { "Authorization" => "Bearer #{response.parsed_body['token']}" }
    @pieces = 3.times.map { SecureRandom.hex(65) }
    @signing = key_b64
    put "/api/v1/keys", headers: @auth, as: :json, params: {
      signing_public_key: @signing, age_recipient: recipient, sondage_share: SecureRandom.hex(65),
      safety_contacts: [
        { name: "Fellow", email: "f@test", role: "self", piece_sha256: sha(@pieces[0]) },
        { name: "Ana", email: "ana@test", role: "family", piece_sha256: sha(@pieces[1]) },
        { name: "Marco", email: "marco@test", role: "family", piece_sha256: sha(@pieces[2]) }
      ]
    }
    assert_response :success
  end

  def recipient = "age1" + Array.new(58) { "qpzry9x8gf2tvdw0s3jn54khce6mua7l".chars.sample }.join
  def sha(hex) = Digest::SHA256.hexdigest([ hex ].pack("H*"))

  test "Sondage keeps only its own piece, encrypted, and fingerprints of the others" do
    assert_equal 3, @fellow.safety_contacts.count
    raw = ActiveRecord::Base.connection.select_value("SELECT sondage_share FROM fellows WHERE id = #{@fellow.id}")
    refute_match(/\A\h{130}\z/, raw, "Sondage's piece must be encrypted at rest")
    assert_match(/\A\h{130}\z/, @fellow.reload.sondage_share)
    @pieces.each { |p| refute_includes SafetyContact.pluck(:piece_sha256), p }
  end

  test "a recovery needs Sondage's piece and one other, and they reach only the new computer" do
    assert_enqueued_emails 4 do # 3 holders + 1 admin
      post "/api/v1/recoveries", params: { recipient: recipient }, headers: @auth, as: :json
    end
    assert_response :created
    id = response.parsed_body["id"]

    post "/safety/lookup", params: { piece_sha256: sha(@pieces[1]) }, as: :json
    assert_response :success
    assert_equal "Ana", response.parsed_body.dig("contact", "name")
    assert_equal id, response.parsed_body.dig("recovery", "id")

    post "/safety/approve", params: { piece_sha256: sha(@pieces[1]), recovery_id: id, encrypted_piece: "sealed-for-new-computer" }, as: :json
    assert_response :success
    get "/api/v1/recoveries/#{id}", headers: @auth
    body = response.parsed_body
    assert_equal [], body["pieces"], "helpers' pieces stay back until Sondage's is released"
    assert_nil body.dig("sondage", "piece"), "Sondage's piece stays back until an admin releases it"
    assert body["contacts"].find { |c| c["name"] == "Ana" }["approved"]

    # An admin releases Sondage's copy after phoning the Fellow and the waiting period.
    travel_to(Recovery.find(id).release_after + 1.minute) do
      sign_in_as_admin
      patch "/recoveries/#{id}/release"
      get "/api/v1/recoveries/#{id}", headers: @auth
      assert_equal @fellow.reload.sondage_share, response.parsed_body.dig("sondage", "piece")
      assert_equal [ "sealed-for-new-computer" ], response.parsed_body["pieces"].map { |p| p["encrypted_piece"] }
    end

    post "/api/v1/recoveries/#{id}/complete", headers: @auth
    assert_equal "complete", Recovery.find(id).status
  end

  test "two helpers' pieces never open anything without Sondage" do
    # Someone in the Fellow's email clicks the Fellow's own safety email; one relative clicks too.
    post "/api/v1/recoveries", params: { recipient: recipient }, headers: @auth, as: :json
    id = response.parsed_body["id"]
    [ @pieces[0], @pieces[1] ].each do |p|
      post "/safety/approve", params: { piece_sha256: sha(p), recovery_id: id, encrypted_piece: "sealed" }, as: :json
      assert_response :success
    end
    get "/api/v1/recoveries/#{id}", headers: @auth
    assert_equal [], response.parsed_body["pieces"]
    refute Recovery.find(id).ready?

    # Even past the waiting period, nothing moves until an admin releases Sondage's copy.
    travel_to(Recovery.find(id).release_after + 1.day) do
      get "/api/v1/recoveries/#{id}", headers: @auth
      assert_equal [], response.parsed_body["pieces"]
    end
  end

  test "Sondage's copy can't be released before the waiting period" do
    was = Rails.configuration.x.recovery_wait_hours
    Rails.configuration.x.recovery_wait_hours = 72
    post "/api/v1/recoveries", params: { recipient: recipient }, headers: @auth, as: :json
    id = response.parsed_body["id"]
    sign_in_as_admin
    patch "/recoveries/#{id}/release"
    refute Recovery.find(id).sondage_released?
  ensure
    Rails.configuration.x.recovery_wait_hours = was
  end

  test "a family member can stop a request that wasn't the Fellow" do
    post "/api/v1/recoveries", params: { recipient: recipient }, headers: @auth, as: :json
    id = response.parsed_body["id"]
    post "/safety/deny", params: { piece_sha256: sha(@pieces[2]), recovery_id: id }, as: :json
    assert_response :success
    assert_equal "blocked", Recovery.find(id).status
    post "/safety/approve", params: { piece_sha256: sha(@pieces[1]), recovery_id: id, encrypted_piece: "x" }, as: :json
    assert_response :not_found
  end

  test "an unknown safety link is refused" do
    post "/safety/lookup", params: { piece_sha256: "0" * 64 }, as: :json
    assert_response :not_found
  end

  private

  def sign_in_as_admin
    post "/sign-in", params: { user: { email: "a@test", password: "pw-123456" } }
  end
end
