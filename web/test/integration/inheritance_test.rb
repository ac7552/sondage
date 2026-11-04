require "test_helper"

class InheritanceTest < ActionDispatch::IntegrationTest
  include Devise::Test::IntegrationHelpers
  include ActionMailer::TestHelper

  RECIPIENT = "age1" + "q" * 58

  setup do
    build_world
    @fellow_user.update!(signing_public_key: key_b64)
    @fellow.update!(sondage_share: "SONDAGE-4 ABCD", age_recipient: RECIPIENT)
    @self_contact = @fellow.safety_contacts.create!(name: "Fellow", email: "f@test", role: "self", piece_sha256: "1" * 64)
    @ana = @fellow.safety_contacts.create!(name: "Ana Ruiz", email: "ana@test", role: "family", piece_sha256: "2" * 64)
    @marco = @fellow.safety_contacts.create!(name: "Marco Ruiz", email: "marco@test", role: "family", piece_sha256: "3" * 64)
  end

  def api_headers(email, password = "pw-123456")
    post "/api/v1/session", params: { email:, password:, client: "test" }, as: :json
    { "Authorization" => "Bearer #{response.parsed_body['token']}" }
  end

  test "the Fellow chooses heirs among family helpers only" do
    headers = api_headers("f@test")
    put "/api/v1/heirs", params: { heir_contact_ids: [ @ana.id, @self_contact.id ] }, headers: headers, as: :json
    assert_response :success
    assert @ana.reload.heir
    refute @marco.reload.heir
    refute @self_contact.reload.heir
  end

  test "only an heir can report a death, and the Fellow and admins are told" do
    post "/safety/report_death", params: { piece_sha256: @ana.piece_sha256 }, as: :json
    assert_response :forbidden # Ana isn't an heir yet

    @ana.update!(heir: true)
    assert_enqueued_emails(2) { post "/safety/report_death", params: { piece_sha256: @ana.piece_sha256 }, as: :json } # admin + the Fellow
    claim = @fellow.inheritance_claims.first
    assert claim.reported?
    refute @fellow.reload.deceased? # nothing changes until Sondage checks
  end

  test "after Sondage confirms, the heir rebuilds the key with their copy plus Sondage's" do
    @ana.update!(heir: true)
    claim = @fellow.inheritance_claims.create!(safety_contact: @ana)

    sign_in @admin
    patch confirm_inheritance_claim_path(claim), params: { note: "" }
    assert claim.reload.reported? # a note about how it was checked is required
    patch confirm_inheritance_claim_path(claim), params: { note: "Obituary; called Marco" }
    claim.reload
    assert claim.confirmed?
    heir = claim.heir_user
    assert heir.heir?
    assert_equal "ana@test", heir.email
    assert @fellow.reload.deceased?
    refute heir.can_see?(@fellow) # an heir never sees the profile, journal or timeline

    # The Fellow's own "new computer" path is closed now.
    post "/api/v1/recoveries", params: { recipient: RECIPIENT }, headers: api_headers("f@test"), as: :json
    assert_response :forbidden

    heir.update!(password: "heir-pass-123")
    headers = api_headers("ana@test", "heir-pass-123")
    get "/api/v1/inheritances", headers: headers
    assert_equal [ claim.id ], response.parsed_body["inheritances"].map { |c| c["id"] }
    assert_equal RECIPIENT, response.parsed_body.dig("inheritances", 0, "fellow", "age_recipient")

    post "/api/v1/inheritances/#{claim.id}/recovery", params: { recipient: RECIPIENT }, headers: headers, as: :json
    assert_response :created
    rid = response.parsed_body["id"]

    # Ana approves from her safety email (the page sees it's her own request).
    post "/safety/lookup", params: { piece_sha256: @ana.piece_sha256 }, as: :json
    assert response.parsed_body.dig("recovery", "inheritance", "mine")
    post "/safety/approve", params: { piece_sha256: @ana.piece_sha256, recovery_id: rid, encrypted_piece: "sealed-to-ana" }, as: :json
    assert_response :success

    get "/api/v1/inheritances/#{claim.id}/recovery/#{rid}", headers: headers
    assert_nil response.parsed_body.dig("sondage", "piece") # not until an admin releases it

    patch release_recovery_path(rid)
    get "/api/v1/inheritances/#{claim.id}/recovery/#{rid}", headers: headers
    assert_equal "SONDAGE-4 ABCD", response.parsed_body.dig("sondage", "piece")
    assert_equal [ "sealed-to-ana" ], response.parsed_body["pieces"].map { |p| p["encrypted_piece"] }

    post "/api/v1/inheritances/#{claim.id}/recovery/#{rid}/complete", headers: headers, as: :json
    assert_equal "complete", claim.reload.status
  end

  test "a second report sends no more emails" do
    @ana.update!(heir: true)
    post "/safety/report_death", params: { piece_sha256: @ana.piece_sha256 }, as: :json
    assert_no_enqueued_emails { post "/safety/report_death", params: { piece_sha256: @ana.piece_sha256 }, as: :json }
    assert_equal 1, @fellow.inheritance_claims.count
  end

  test "when a family member stops an heir's request, the heir can't simply ask again" do
    @ana.update!(heir: true)
    claim = @fellow.inheritance_claims.create!(safety_contact: @ana)
    claim.confirm!(@admin, note: "checked")
    claim.heir_user.update!(password: "heir-pass-123")
    headers = api_headers("ana@test", "heir-pass-123")
    post "/api/v1/inheritances/#{claim.id}/recovery", params: { recipient: RECIPIENT }, headers: headers, as: :json
    rid = response.parsed_body["id"]
    post "/safety/deny", params: { piece_sha256: @marco.piece_sha256, recovery_id: rid }, as: :json
    assert_response :success
    post "/api/v1/inheritances/#{claim.id}/recovery", params: { recipient: RECIPIENT }, headers: headers, as: :json
    assert_response :forbidden
  end

  test "someone who isn't an heir can't use the inheritance API" do
    get "/api/v1/inheritances", headers: api_headers("f@test")
    assert_response :forbidden
  end

  test "an admin can mark a report as not true" do
    @ana.update!(heir: true)
    claim = @fellow.inheritance_claims.create!(safety_contact: @ana)
    sign_in @admin
    patch refuse_inheritance_claim_path(claim)
    assert_equal "refused", claim.reload.status
    refute @fellow.reload.deceased?
  end
end
