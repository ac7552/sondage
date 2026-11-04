require "test_helper"

class DesktopApiTest < ActionDispatch::IntegrationTest
  setup { build_world }

  def sign_in
    post "/api/v1/session", params: { email: "f@test", password: "pw-123456", client: "test" }, as: :json
    assert_response :created
    { "Authorization" => "Bearer #{response.parsed_body['token']}" }
  end

  test "only a digest of the desktop token is stored" do
    headers = sign_in
    token = headers["Authorization"].split.last
    assert_nil ApiToken.find_by(token_digest: token)
    assert ApiToken.find_by(token_digest: ApiToken.digest(token))
  end

  test "wrong password is refused" do
    post "/api/v1/session", params: { email: "f@test", password: "nope" }, as: :json
    assert_response :unauthorized
  end

  test "the Fellow registers public keys and sees their interview with the historian's key" do
    headers = sign_in
    signing = key_b64
    recipient = "age1" + "q" * 58
    put "/api/v1/keys", params: { signing_public_key: signing, age_recipient: recipient }, headers:, as: :json
    assert_response :success
    get "/api/v1/me", headers:
    body = response.parsed_body
    assert_equal signing, body.dig("fellow", "signing_public_key")
    assert_equal @historian.signing_public_key, body.dig("interviews", 0, "historian", "signing_public_key")
  end

  test "a receipt is accepted only with both registered keys, and only once" do
    headers = sign_in
    @fellow_user.update!(signing_public_key: key_b64)
    receipt = {
      capsuleId: SecureRandom.uuid, sealedAt: Time.current.iso8601, manifestSha256: "a" * 64, capsuleSha256: "b" * 64, capsuleBytes: 1234,
      timestamp: { status: "granted", genTime: Time.current.iso8601 },
      signatures: [ { role: "fellow", publicKey: @fellow_user.signing_public_key, signature: "x" }, { role: "historian", publicKey: key_b64, signature: "y" } ]
    }
    post "/api/v1/interviews/#{@interview.id}/capsule", params: { receipt: }, headers:, as: :json
    assert_response :unprocessable_entity, "a historian key that isn't registered must be refused"

    receipt[:signatures][1][:publicKey] = @historian.signing_public_key
    post "/api/v1/interviews/#{@interview.id}/capsule", params: { receipt: }, headers:, as: :json
    assert_response :created
    assert_equal "sealed", @interview.reload.status
    assert_equal "delivered", @fellow.reload.stage
    assert_equal "a" * 64, @interview.capsule.manifest_sha256

    post "/api/v1/interviews/#{@interview.id}/capsule", params: { receipt: }, headers:, as: :json
    assert_response :conflict
  end

  test "historians and admins cannot use the desktop API" do
    post "/api/v1/session", params: { email: "h@test", password: "pw-123456" }, as: :json
    token = response.parsed_body["token"]
    put "/api/v1/keys", params: { signing_public_key: key_b64, age_recipient: "age1" + "q" * 58 }, headers: { "Authorization" => "Bearer #{token}" }, as: :json
    assert_response :forbidden
  end
end
