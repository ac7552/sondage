require "test_helper"

# The first version of Sondage Resounder: features beyond the Sitting are switched
# off, the app learns the Season and Sitting, and the Senior Fellow is emailed.
class ResounderTest < ActionDispatch::IntegrationTest
  include ActionMailer::TestHelper

  setup do
    build_world
    @fellow.update!(given_name: "María", surname: "Núñez de la Cruz", convocation_year: 2027)
    post "/api/v1/session", params: { email: "f@test", password: "pw-123456" }, as: :json
    @auth = { "Authorization" => "Bearer #{response.parsed_body['token']}" }
  end

  test "the Season key follows Stephen's naming rules" do
    assert_equal "2027-nunez-de-la-cruz-maria", @fellow.season_key
    @fellow.update!(convocation_year: nil)
    assert_nil @fellow.season_key
  end

  test "switched-off features answer not found, on the website and in the API" do
    Feature.with do
      get "/api/v1/journal", headers: @auth
      assert_response :not_found
      get "/api/v1/fellow/timeline", headers: @auth
      assert_response :not_found
      put "/api/v1/keys", headers: @auth, as: :json, params: {}
      assert_response :not_found
      post "/sign-in", params: { user: { email: "f@test", password: "pw-123456" } }
      get "/fellows/#{@fellow.id}/journal"
      assert_response :not_found
      get "/"
      assert_response :success
      assert_select "nav a", text: "My journal", count: 0
    end
  end

  test "the app learns which features are on, the Sitting length and the Season" do
    Feature.with("journal") do
      get "/api/v1/me", headers: @auth
      body = response.parsed_body
      assert_equal [ "journal" ], body["features"]
      assert_equal Rails.configuration.x.sitting_minutes, body.dig("sitting", "minutes")
      assert_equal "2027-nunez-de-la-cruz-maria", body.dig("fellow", "season", "key")
      assert_equal 1, body.dig("interviews", 0, "sitting")
    end
  end

  test "ending a Sitting emails the Senior Fellow once, with plain facts" do
    times = { started_at: "2027-02-02T14:00:00-05:00", ended_at: "2027-02-02T14:58:30-05:00" }
    assert_enqueued_emails 1 do
      post "/api/v1/interviews/#{@interview.id}/sitting", headers: @auth, params: times, as: :json
    end
    assert_response :success
    assert @interview.reload.sealed?
    mail = SittingMailer.confirmation(@interview, started_at: Time.iso8601(times[:started_at]), ended_at: Time.iso8601(times[:ended_at]))
    text = mail.text_part.body.to_s
    assert_includes text, "Sitting 01"
    assert_includes text, "2:00 PM"
    assert_includes text, "2:58 PM"
    assert_includes text, "No AI was involved"
    assert_equal [ "f@test" ], mail.to

    assert_no_enqueued_emails do # a retry from the app doesn't email twice
      post "/api/v1/interviews/#{@interview.id}/sitting", headers: @auth, params: times, as: :json
    end
  end

  test "a Sitting can't be reported for someone else's interview" do
    other = Fellow.create!(user: User.create!(name: "O", email: "o@test", password: "pw-123456", role: "fellow"))
    theirs = Meeting.create!(fellow: other, host: @historian, kind: "interview", title: "Theirs")
    post "/api/v1/interviews/#{theirs.id}/sitting", headers: @auth, params: { started_at: "2027-02-02T14:00:00Z", ended_at: "2027-02-02T15:00:00Z" }, as: :json
    assert_response :not_found
  end
end
